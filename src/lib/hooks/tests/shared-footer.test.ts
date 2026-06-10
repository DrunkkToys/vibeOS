import test from "node:test"
import assert from "node:assert/strict"
import { buildEnforcementTags, buildFooterLine, formatSavingsPulse, formatVectorPulse, resolveBrand, resolveTierIcon, trendGlyph } from "../shared-footer.js"

test("shared-footer resolves the expected brand names", () => {
  assert.equal(resolveBrand("vibemax", "brain"), "VibeMaX")
  assert.equal(resolveBrand("quality", "medium"), "VibeQMaX")
  assert.equal(resolveBrand("unknown", "cheap"), "VibeMaX")
})

test("shared-footer keeps tier icons compact and stable", () => {
  assert.equal(resolveTierIcon("brain"), "🧠")
  assert.equal(resolveTierIcon("medium"), "◐")
  assert.equal(resolveTierIcon("cheap"), "⚡")
  assert.equal(resolveTierIcon("free"), "🎁")
})

test("shared-footer formats a compact vector pulse", () => {
  assert.equal(formatVectorPulse("cheap"), "⟡ cheap")
  assert.equal(formatVectorPulse(undefined), "")
})

test("shared-footer formats a subtle savings pulse with trend cues", () => {
  assert.equal(formatSavingsPulse(12.57, "up"), "$12.57 saved ↗")
  assert.equal(formatSavingsPulse(4.2, "down"), "$4.20 saved ↘")
  assert.equal(formatSavingsPulse(0, "up"), "")
  assert.equal(trendGlyph("flat"), "→")
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
    vectorChangedSlot: "cheap",
  })

  assert.ok(line.includes("◐ medium"))
  assert.ok(line.includes("$12.57 saved ↗"))
  assert.ok(line.includes("VibeMaX ⚡"))
  assert.ok(line.includes("[ENF ON]"))
  assert.ok(line.includes("⟡ cheap"))
})
