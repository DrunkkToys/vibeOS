import { describe, it } from "node:test"
import assert from "node:assert"

// ── Pure functions extracted from src/lib/hooks/footer.ts ──

const REGIME_TAG = {
  INIT: "Starting", DIVERGENT: "Off-track", EXPLORING: "Exploring", REFINING: "Refining",
  IMPLEMENTING: "Building", RESEARCH: "Researching", REVIEWING: "Reviewing", DESIGNING: "Designing",
  CONVERGING: "Converging", CLOSED: "Closed", LOOPING: "Looping", AUDIT: "Auditing", FORENSIC: "Deep dive",
}
const REGIME_ICON = {
  INIT: "◌", DIVERGENT: "⇄", EXPLORING: "⌕", REFINING: "✎", IMPLEMENTING: "⚙",
  RESEARCH: "⌁", REVIEWING: "✓", DESIGNING: "◫", CONVERGING: "⟲", CLOSED: "◆",
  LOOPING: "↻", AUDIT: "☑", FORENSIC: "⟁",
}
const TIER_ICON = { brain: "\u{1F9E0}", medium: "\u25D0", cheap: "\u26A1", free: "\u{1F381}" }

function resolveTierIcon(slot) { return TIER_ICON[slot] || "\u26A1" }
function resolveRegimeIcon(r) { return REGIME_ICON[String(r || "").toUpperCase()] || "◦" }
function trendGlyph(t) { return t === "up" ? "↗" : t === "down" ? "↘" : "→" }
function formatSavingsPulse(a, t) { const n = Number(a || 0); if (!Number.isFinite(n) || n <= 0) return ""; return `$${n.toFixed(2)} saved${(t && t !== "neutral") ? ` ${trendGlyph(t)}` : ""}` }
function formatCascadePulse(i, l) { const ic = String(i || "").trim(); const lb = String(l || "").trim(); if (!ic && !lb) return ""; return [ic, lb].filter(Boolean).join(" ") }
function formatEnforcementPulse(tags) {
  const s = new Set(tags || []), p = []
  if (s.has("[Q&A]")) { p.push("quiet mode") } else {
    if (s.has("[ENF ON]") || s.has("[STRICT]")) p.push("guarded")
    if (s.has("[FLOW ON]")) p.push("flow steady")
    if (s.has("[TDD ON]")) p.push("tests live")
  }
  if (s.has("[LOCK ON]")) p.push("locked")
  return p.join(" · ")
}
function formatModeLabel(m) {
  const n = String(m || "").toLowerCase()
  if (!n) return ""
  if (n === "vibemax") return "VibeMaX"
  if (n === "vibelitex" || n === "litex") return "VibeLiteX"
  if (n === "vibeqmax") return "VibeQMaX"
  if (n === "vibeultrax") return "VibeUltraX"
  if (n === "speed") return "Speed"
  if (n === "longrun") return "Longrun"
  if (n === "audit") return "Audit"
  if (n === "forensic") return "Forensic"
  if (n === "balanced") return "Balanced"
  if (n === "budget") return "Budget"
  if (n === "quality") return "Quality"
  return n.charAt(0).toUpperCase() + n.slice(1)
}

function buildFooterLine(input) {
  const { activeSlot, providerLabel, modelName, ltTrend, vibeBrand, optMode, flashIcon, enfTags, subRegime } = input
  const savingsTotal = Number.isFinite(Number(input.savingsTotal ?? input.ltTotal)) ? Number(input.savingsTotal ?? input.ltTotal) : 0
  const tierIcon = resolveTierIcon(activeSlot)
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null
  const modeLabel = formatModeLabel(optMode)
  const workerSuffix = input.workerSlot ? ` [${input.workerSlot}]` : ""
  let line = `— ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${workerSuffix}${regimeTag ? ` ▶ ${regimeIcon} ${regimeTag}` : ""}`
  if (savingsTotal > 0) {
    const sp = formatSavingsPulse(savingsTotal, ltTrend)
    if (sp) line += ` | ${sp}`
  } else { line += " | VIBE" }
  if (vibeBrand) { line += ` | ${vibeBrand}${flashIcon || ""}` }
  else if (flashIcon && flashIcon.trim()) { line += ` | ${flashIcon.trim()}` }
  const cascadePulse = formatCascadePulse(input.cascadeIcon, input.cascadeLabel)
  if (cascadePulse) line += ` | ${cascadePulse}`
  const enforcementPulse = formatEnforcementPulse(enfTags)
  if (enforcementPulse) line += ` | ${enforcementPulse}`
  if (input.alertTag) line += ` | ${input.alertTag}`
  if (input.stressGauge) line += ` | ${input.stressGauge}`
  if (input.claimTag) line += ` | ${input.claimTag}`
  if (input.rewardTag) line += ` | ${input.rewardTag}`
  line += " —"
  return line
}

// ── Tests ──

describe("deep footer segments order", () => {
  it("segments appear in correct order: tier→provider→model→regime→savings→brand→cascade→enforcement→alert→stress→claim→reward", () => {
    const line = buildFooterLine({
      activeSlot: "brain",
      providerLabel: "Deepseek",
      modelName: "V4 Pro",
      savingsTotal: 0.83,
      ltTrend: "up",
      vibeBrand: "VibeQMaX",
      optMode: "vibeqmax",
      flashIcon: " ⚡",
      enfTags: ["[ENF ON]", "[TDD ON]"],
      subRegime: "LOOPING",
      stressGauge: "▅",
      cascadeIcon: "▸▸",
      alertTag: "⚠ model drift",
      claimTag: "✓ verified",
      rewardTag: "+5 XP",
    })
    const segments = line.split(" | ").map(s => s.replace(/^— /, "").replace(/ —$/, ""))
    assert.equal(segments[0], "\u{1F9E0} brain", "segment 0: tier icon + slot")
    assert.equal(segments[1], "Deepseek", "segment 1: provider")
    assert.equal(segments[2], "V4 Pro ▶ ↻ Looping", "segment 2: model + regime")
    assert.ok(segments[3].includes("$0.83 saved"), "segment 3: savings")
    assert.ok(segments[4].includes("VibeQMaX"), "segment 4: brand + flash")
    assert.equal(segments[5], "▸▸", "segment 5: cascade icon")
    assert.ok(segments[6].includes("guarded"), "segment 6: enforcement")
    assert.ok(segments[7].includes("⚠ model drift"), "segment 7: alert")
    assert.equal(segments[8], "▅", "segment 8: stress gauge")
    assert.equal(segments[9], "✓ verified", "segment 9: claim tag")
    assert.equal(segments[10], "+5 XP", "segment 10: reward tag")
    assert.equal(segments.length, 11, "footer has exactly 11 segments when all present")
  })

  it("starts with em dash and ends with em dash", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "Opencode", modelName: "Big Pickle",
      vibeBrand: "vibeOS",
    })
    assert.ok(line.startsWith("— "), "starts with em dash")
    assert.ok(line.endsWith(" —"), "ends with em dash")
  })

  it("all segments separated by pipe+space", () => {
    const line = buildFooterLine({
      activeSlot: "medium", providerLabel: "Anthropic", modelName: "Sonnet",
      savingsTotal: 1.0, vibeBrand: "VibeUltraX", optMode: "vibeultrax",
      enfTags: ["[ENF ON]"], stressGauge: "▂", cascadeIcon: "▸▸▸",
      alertTag: "⚠ api degraded",
    })
    assert.ok(!line.includes(" |  "), "no double spaces in pipe separators")
    assert.ok(!line.includes("  |"), "no double spaces before pipe")
  })

  it("regime segment only appears when subRegime is set", () => {
    const withRegime = buildFooterLine({
      activeSlot: "brain", providerLabel: "X", modelName: "Y",
      subRegime: "IMPLEMENTING", vibeBrand: "vibeOS",
    })
    const withoutRegime = buildFooterLine({
      activeSlot: "brain", providerLabel: "X", modelName: "Y",
      vibeBrand: "vibeOS",
    })
    assert.ok(withRegime.includes("▶"), "with regime has arrow")
    assert.ok(!withoutRegime.includes("▶"), "without regime has no arrow")
  })

  it("savings segment shows $X.XX saved when positive", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "X", modelName: "Y",
      savingsTotal: 2.50, ltTrend: "up", vibeBrand: "vibeOS",
    })
    assert.ok(line.includes("$2.50 saved ↗"), "savings shows amount with trend arrow")
  })

  it("VIBE placeholder used when savings is 0", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "X", modelName: "Y",
      savingsTotal: 0, vibeBrand: "vibeOS",
    })
    assert.ok(line.includes("| VIBE"), "VIBE placeholder present")
  })

  it("brand segment includes flash icon", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "X", modelName: "Y",
      vibeBrand: "VibeUltraX", flashIcon: " ⚡",
    })
    assert.ok(line.includes("VibeUltraX ⚡"), "brand + flash icon together")
  })

  it("enforcement pulse shows multiple tags separated by ·", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "X", modelName: "Y",
      vibeBrand: "vibeOS", enfTags: ["[ENF ON]", "[FLOW ON]", "[TDD ON]"],
    })
    assert.ok(line.includes("guarded · flow steady · tests live"), "all enforcement tags rendered")
  })

  it("quiet mode replaces guarded/flow/tdd with quiet mode", () => {
    const line = buildFooterLine({
      activeSlot: "cheap", providerLabel: "X", modelName: "Y",
      vibeBrand: "vibeOS", enfTags: ["[Q&A]"],
    })
    assert.ok(line.includes("quiet mode"), "quiet mode tag present")
    assert.ok(!line.includes("guarded"), "guarded not present in quiet mode")
  })
})
