// SPDX-License-Identifier: MIT
// Shared footer formatting — single source of truth for text.complete and tool.execute.after

export interface FooterLineInput {
  activeSlot: string
  sessionSlot?: string
  providerLabel: string
  modelName: string
  ltTotal: number
  ltTrend?: string
  vibeBrand: string
  optMode: string
  flashIcon: string
  enfTags: string[]
  vectorChangedSlot?: string
  subRegime?: string
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

export function buildFooterLine(input: FooterLineInput): string {
  const { activeSlot, sessionSlot, providerLabel, modelName, ltTotal, ltTrend, vibeBrand, optMode, flashIcon, enfTags, vectorChangedSlot, subRegime } = input

  const tierIcon = resolveTierIcon(activeSlot)
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null
  const modeLabel = formatModeLabel(optMode)
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${regimeTag ? ` \u25B6 ${regimeIcon} ${regimeTag}` : ""}`

  if (ltTotal > 0) {
    const savingsPulse = formatSavingsPulse(ltTotal, ltTrend)
    if (savingsPulse) line += ` | ${savingsPulse}`
  }

  line += ` | ${vibeBrand}${flashIcon}`

  if (optMode && optMode !== "auto") {
    line += ` · ${modeLabel}`
  }

  if (vectorChangedSlot && vectorChangedSlot !== activeSlot) {
    line += ` | ${formatVectorPulse(vectorChangedSlot)}`
  }

  const enforcementPulse = formatEnforcementPulse(enfTags)
  if (enforcementPulse) {
    line += ` | ${enforcementPulse}`
  }

  if (sessionSlot && sessionSlot !== activeSlot) {
    line += ` | session:${sessionSlot}`
  }
  line += " \u2014"

  return line
}
