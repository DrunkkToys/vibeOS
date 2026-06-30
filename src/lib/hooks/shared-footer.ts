// SPDX-License-Identifier: MIT
// Shared footer formatting — single source of truth for text.complete and tool.execute.after

export interface FooterLineInput {
  activeSlot: string
  sessionSlot?: string
  providerLabel: string
  modelName: string
  savingsTotal?: number
  ltTotal?: number
  ltTrend?: string
  vibeBrand: string
  optMode: string
  flashIcon: string
  enfTags: string[]
  vectorChangedSlot?: string
  subRegime?: string
  stressGauge?: string
  cascadeIcon?: string
  cascadeLabel?: string
  claimTag?: string
  rewardTag?: string
  alertTag?: string
}

const REGIME_TAG: Record<string, string> = {
  INIT: "INIT",
  DIVERGENT: "DVRG",
  EXPLORING: "XPLR",
  REFINING: "RFNE",
  IMPLEMENTING: "IMPL",
  RESEARCH: "RSCH",
  REVIEWING: "RVW",
  DESIGNING: "DSGN",
  CONVERGING: "CVGE",
  CLOSED: "CLSD",
  LOOPING: "LOOP",
  AUDIT: "AUDT",
  FORENSIC: "FRNC",
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
  vibeultrax: "VibeUltraX",
  vibeqmax: "VibeQMaX",
  vibemax: "VibeMaX",
  litex: "VibeLiteX",
  quality: "VibeQMaX",
  audit: "VibeQMaX",
  forensic: "VibeQMaX",
}

const TIER_ICON: Record<string, string> = {
  brain: "\u{1F9E0}",
  medium: "\u25D0",
  cheap: "\u26A1",
  free: "\u{1F381}",
}

export function resolveBrand(optMode: string, activeSlot: string): string {
  return BRAND_MAP[optMode] || (activeSlot === "brain" ? "VibeQMaX" : "VibeMaX")
}

export function resolveTierIcon(slot: string): string {
  return TIER_ICON[slot] || "\u26A1"
}

export function resolveRegimeIcon(subRegime: string): string {
  return REGIME_ICON[String(subRegime || "").toUpperCase()] || "◦"
}

export function formatModeLabel(optMode: string): string {
  const normalized = String(optMode || "").toLowerCase()
  if (!normalized) return ""
  if (normalized === "vibemax" || normalized === "vibelitex" || normalized === "budget") return "Budget"
  if (normalized === "vibeqmax" || normalized === "quality") return "Quality"
  if (normalized === "vibeultrax") return "VibeUltraX"
  if (normalized === "speed") return "Speed"
  if (normalized === "longrun") return "Longrun"
  if (normalized === "audit") return "Audit"
  if (normalized === "forensic") return "Forensic"
  if (normalized === "balanced") return "Balanced"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function formatVectorPulse(vectorChangedSlot?: string): string {
  if (!vectorChangedSlot) return ""
  return `⟡ ${vectorChangedSlot}`
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

// SINGLE SOURCE OF TRUTH degrade path. There is exactly ONE footer line format
// (buildFooterLine). When the rich path can't gather every field (a sub-call threw,
// or this is the index.ts safety net), we still render the SAME README line with safe
// defaults for the missing fields — never a different, shorter, alert-less line. This
// replaces the old buildFallbackFooterLine, which painted a degraded 3-segment
// "— ⚡ cheap | OpenCode | Big Pickle —" that dropped savings/mode/brand/ALERT and was
// all the user ever saw whenever the rich footer threw.
export function buildResilientFooterLine(partial?: Partial<FooterLineInput> | null): string {
  const p = partial && typeof partial === "object" ? partial : {}
  const activeSlot = typeof p.activeSlot === "string" && p.activeSlot ? p.activeSlot : "cheap"
  const providerLabel = typeof p.providerLabel === "string" && p.providerLabel ? p.providerLabel : "Unknown"
  const modelName = typeof p.modelName === "string" && p.modelName ? p.modelName : "unknown"
  const savingsTotalNum = Number(p.savingsTotal ?? p.ltTotal)
  const savingsTotal = Number.isFinite(savingsTotalNum) ? savingsTotalNum : 0
  const optMode = typeof p.optMode === "string" ? p.optMode : ""
  const vibeBrand = typeof p.vibeBrand === "string" && p.vibeBrand ? p.vibeBrand : resolveBrand(optMode, activeSlot)
  const enfTags = Array.isArray(p.enfTags) ? p.enfTags : []
  try {
    return buildFooterLine({
      activeSlot,
      sessionSlot: p.sessionSlot,
      providerLabel,
      modelName,
      savingsTotal,
      ltTotal: savingsTotal,
      ltTrend: p.ltTrend,
      vibeBrand,
      optMode,
      flashIcon: typeof p.flashIcon === "string" ? p.flashIcon : "",
      enfTags,
      vectorChangedSlot: p.vectorChangedSlot,
      subRegime: p.subRegime,
      stressGauge: p.stressGauge,
      cascadeIcon: p.cascadeIcon,
      claimTag: p.claimTag,
      rewardTag: p.rewardTag,
      alertTag: p.alertTag,
    })
  } catch {
    // Absolute last resort: still the README em-dash wrapper + tier icon + brand,
    // so even a catastrophic failure can never reproduce the bare 3-segment line.
    const tierIcon = resolveTierIcon(activeSlot)
    const cascade = formatCascadePulse(p.cascadeIcon, p.cascadeLabel)
    const alert = typeof p.alertTag === "string" && p.alertTag ? ` | ${p.alertTag}` : ""
    const cascadePart = cascade ? ` | ${cascade}` : ""
    return `— ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${cascadePart} | ${vibeBrand}${alert} —`
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
  const { activeSlot, sessionSlot, providerLabel, modelName, ltTrend, vibeBrand, optMode, flashIcon, enfTags, vectorChangedSlot, subRegime } = input
  const savingsTotal = Number.isFinite(Number(input.savingsTotal ?? input.ltTotal)) ? Number(input.savingsTotal ?? input.ltTotal) : 0

  const tierIcon = resolveTierIcon(activeSlot)
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null
  const modeLabel = formatModeLabel(optMode)
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${regimeTag ? ` \u25B6 ${regimeIcon} ${regimeTag}` : ""}`

  if (savingsTotal > 0) {
    const savingsPulse = formatSavingsPulse(savingsTotal, ltTrend)
    if (savingsPulse) line += ` | ${savingsPulse}`
  }

  line += ` | ${vibeBrand}${flashIcon}`

  // Avoid rendering the brand twice (e.g. "VibeUltraX · VibeUltraX") when the
  // mode label resolves to the same text as the brand.
  if (optMode && optMode !== "auto" && modeLabel && modeLabel !== vibeBrand) {
    line += ` · ${modeLabel}`
  }

  const cascadePulse = formatCascadePulse(input.cascadeIcon, input.cascadeLabel)
  if (cascadePulse) {
    line += ` | ${cascadePulse}`
  }

  if (vectorChangedSlot && vectorChangedSlot !== activeSlot) {
    line += ` | ${formatVectorPulse(vectorChangedSlot)}`
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

  if (sessionSlot && sessionSlot !== activeSlot) {
    line += ` | session:${sessionSlot}`
  }
  line += " \u2014"

  return line
}
