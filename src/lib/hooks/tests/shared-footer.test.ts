import test from "node:test"
import assert from "node:assert/strict"
import { buildEnforcementTags, buildResilientFooterLine, buildFooterLine, formatCascadePulse, formatEnforcementPulse, formatModeLabel, formatSavingsPulse, resolveBrand, resolveRegimeIcon, resolveTierIcon, trendGlyph } from "../shared-footer.js"

test("shared-footer resolves the expected brand names", () => {
  assert.equal(resolveBrand("vibemax", "brain"), "VibeMaX")
  assert.equal(resolveBrand("quality", "medium"), "VibeQMaX")
  assert.equal(resolveBrand("vibeultrax", "cheap"), "VibeUltraX")
  assert.equal(resolveBrand("raw", "brain"), "Raw Brain")
  assert.equal(resolveBrand("unknown", "cheap"), "vibeOS")
})

test("shared-footer keeps tier icons compact and stable", () => {
  assert.equal(resolveTierIcon("brain"), "🧠")
  assert.equal(resolveTierIcon("medium"), "◐")
  assert.equal(resolveTierIcon("cheap"), "⚡")
  assert.equal(resolveTierIcon("free"), "🎁")
})

test("shared-footer assigns a unique icon to each regime", () => {
  const icons = {
    INIT: resolveRegimeIcon("INIT"),
    DIVERGENT: resolveRegimeIcon("DIVERGENT"),
    EXPLORING: resolveRegimeIcon("EXPLORING"),
    REFINING: resolveRegimeIcon("REFINING"),
    IMPLEMENTING: resolveRegimeIcon("IMPLEMENTING"),
    RESEARCH: resolveRegimeIcon("RESEARCH"),
    REVIEWING: resolveRegimeIcon("REVIEWING"),
    DESIGNING: resolveRegimeIcon("DESIGNING"),
    CONVERGING: resolveRegimeIcon("CONVERGING"),
    CLOSED: resolveRegimeIcon("CLOSED"),
    LOOPING: resolveRegimeIcon("LOOPING"),
    AUDIT: resolveRegimeIcon("AUDIT"),
    FORENSIC: resolveRegimeIcon("FORENSIC"),
  }
  const values = Object.values(icons)
  assert.equal(new Set(values).size, values.length, "regime icons should be unique")
})

test("shared-footer formats a subtle savings pulse with trend cues", () => {
  assert.equal(formatSavingsPulse(12.57, "up"), "$12.57 saved ↗")
  assert.equal(formatSavingsPulse(4.2, "down"), "$4.20 saved ↘")
  assert.equal(formatSavingsPulse(0, "up"), "")
  assert.equal(trendGlyph("flat"), "→")
})

test("shared-footer formats cascade icon and label together", () => {
  assert.equal(formatCascadePulse("▸▸▸", ""), "▸▸▸")
  assert.equal(formatCascadePulse("▸▸", ""), "▸▸")
  assert.equal(formatCascadePulse(undefined, undefined), "")
})

test("shared-footer formats visible mode labels for branded modes", () => {
  assert.equal(formatModeLabel("vibemax"), "VibeMaX")
  assert.equal(formatModeLabel("vibelitex"), "VibeLiteX")
  assert.equal(formatModeLabel("vibeqmax"), "VibeQMaX")
})

test("shared-footer builds short enforcement tags", () => {
  assert.deepEqual(buildEnforcementTags({
    delegationEnforce: true,
    flowEnforce: true,
    tddEnforce: true,
    bbMode: "strict",
    modelLocked: true,
  }), ["[ENF ON]", "[FLOW ON]", "[TDD ON]", "[STRICT]", "[LOCK ON]"])
})

test("shared-footer quiets greetings without carrying tdd tags", () => {
  assert.deepEqual(buildEnforcementTags({
    delegationEnforce: true,
    flowEnforce: true,
    tddEnforce: true,
    bbMode: "normal",
    modelLocked: true,
    quietIntent: true,
  }), ["[Q&A]", "[LOCK ON]"])
})

test("shared-footer keeps the footer compact while showing savings and slot state", () => {
  const line = buildFooterLine({
    activeSlot: "medium",
    sessionSlot: "medium",
    providerLabel: "DeepSeek",
    modelName: "v4-flash",
    ltTotal: 12.57,
    ltTrend: "up",
    vibeBrand: "VibeMaX",
    optMode: "budget",
    flashIcon: " ⚡",
    enfTags: ["[ENF ON]"],
  })

  assert.ok(line.includes("◐ medium"))
  assert.ok(line.includes("$12.57 saved ↗"))
  assert.ok(line.includes("VibeMaX ⚡"))
  assert.ok(line.includes("guarded"))
})

test("shared-footer degrade path renders the ONE README footer, never the bare 3-segment line", () => {
  const line = buildResilientFooterLine({
    activeSlot: "cheap",
    providerLabel: "Opencode",
    modelName: "Big Pickle",
  })

  // The degrade path keeps the provider/model but is still the full README line
  // (em-dash wrapper + tier icon + Vibe brand) — NOT the old alert-less
  // "— ⚡ cheap | Opencode | Big Pickle —" the user kept seeing.
  assert.ok(line.startsWith("—") && line.trimEnd().endsWith("—"))
  assert.ok(line.includes("⚡ cheap"))
  assert.ok(line.includes("Opencode | Big Pickle"))
  assert.ok(/vibeOS|Vibe/.test(line), "the one footer always carries the footer product brand")
  assert.notEqual(line, "— ⚡ cheap | Opencode | Big Pickle —")
})

test("shared-footer renders experimental regime tags cleanly", () => {
  const line = buildFooterLine({
    activeSlot: "brain",
    providerLabel: "DeepSeek",
    modelName: "v4-pro",
    ltTotal: 0,
    vibeBrand: "VibeQMaX",
    optMode: "quality",
    flashIcon: "",
    enfTags: [],
    subRegime: "IMPLEMENTING",
  })

  assert.ok(line.includes("▶ ⚙ Building"))
})

test("shared-footer shows cascade arrow icon without text suffix", () => {
  const line = buildFooterLine({
    activeSlot: "medium",
    providerLabel: "DeepSeek",
    modelName: "v4-flash",
    ltTotal: 0,
    vibeBrand: "VibeQMaX",
    optMode: "vibeultrax",
    flashIcon: "",
    enfTags: [],
    cascadeIcon: "▸▸▸",
    cascadeLabel: "",
  })

  assert.ok(line.includes("▸▸▸"), "cascade arrow icon appears")
  assert.ok(!line.includes("▸▸▸ brain"), "no tier text suffix after arrow")
})

test("shared-footer softens enforcement tags into a compact pulse", () => {
  assert.equal(formatEnforcementPulse(["[ENF ON]", "[TDD ON]"]), "guarded · tests live")
  assert.equal(formatEnforcementPulse(["[Q&A]", "[LOCK ON]"]), "quiet mode · locked")
})
