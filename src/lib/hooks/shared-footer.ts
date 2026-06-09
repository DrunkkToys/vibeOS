// SPDX-License-Identifier: MIT
// Shared footer formatting — single source of truth for text.complete and tool.execute.after

export interface FooterLineInput {
  activeSlot: string
  sessionSlot?: string
  providerLabel: string
  modelName: string
  ltTotal: number
  vibeBrand: string
  optMode: string
  flashIcon: string
  enfTags: string[]
  vectorChangedSlot?: string
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
  medium: "\u2699\uFE0F",
  cheap: "\u{1F381}",
}

export function resolveBrand(optMode: string, activeSlot: string): string {
  return BRAND_MAP[optMode] || (activeSlot === "brain" ? "VibeQMaX" : "VibeMaX")
}

export function resolveTierIcon(slot: string): string {
  return TIER_ICON[slot] || "\u26A1"
}

export function buildEnforcementTags(opts: {
  delegationEnforce: boolean
  flowEnforce: boolean
  tddEnforce: boolean
  bbMode: string
  modelLocked: boolean
}): string[] {
  const tags: string[] = []
  if (opts.bbMode === "relaxed") {
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
  const { activeSlot, sessionSlot, providerLabel, modelName, ltTotal, vibeBrand, optMode, flashIcon, enfTags, vectorChangedSlot } = input

  const tierIcon = resolveTierIcon(activeSlot)
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}`

  if (ltTotal > 0) {
    line += ` | $${ltTotal.toFixed(2)}`
  }

  line += ` | ${vibeBrand}${flashIcon}`

  if (optMode && optMode !== "auto") {
    line += ` ${optMode}`
  }

  if (vectorChangedSlot) {
    line += ` | \u2192 ${vectorChangedSlot}`
  }

  if (enfTags.length > 0) {
    line += ` ${enfTags.join(" ")}`
  }

  line += ` | slot:${activeSlot}`
  if (sessionSlot && sessionSlot !== activeSlot) {
    line += ` | session:${sessionSlot}`
  }
  line += " \u2014"

  return line
}
