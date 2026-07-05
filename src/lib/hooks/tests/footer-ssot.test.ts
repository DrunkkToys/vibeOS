// SPDX-License-Identifier: MIT
// TDD contract for the footer Single Source Of Truth (SSOT) fix.
//
// Symptom this locks down: live OpenCode sessions only ever showed the degraded
// 3-segment line "— ◐ medium | OpenCode Go | Mimo V2.5 —" (buildFallbackFooterLine),
// because the rich footer threw every turn and a SECOND, alert-less builder won.
// After the fix there must be exactly ONE footer renderer (buildFooterLine) and the
// degrade path must produce the SAME README line (fewer fields), never a different
// shorter format that drops the alert.
import { describe, it } from "node:test"
import assert from "node:assert/strict"

const sf = await import("../shared-footer.js")

describe("footer SSOT — exactly one renderer", () => {
  it("the alert-less second builder buildFallbackFooterLine is gone", () => {
    // The degraded 3-segment line must be impossible to render. Deleting the
    // builder is what guarantees "only 1 footer".
    assert.equal(
      (sf as Record<string, unknown>).buildFallbackFooterLine,
      undefined,
      "buildFallbackFooterLine must be removed — it is the alert-less line the user kept seeing",
    )
  })

  it("buildResilientFooterLine exists and is the single degrade-safe entry point", () => {
    assert.equal(
      typeof sf.buildResilientFooterLine,
      "function",
      "both _appendFooter (degrade path) and ensureFooterFallback must call this one renderer",
    )
  })
})

describe("footer SSOT — the one renderer never collapses to 3 segments", () => {
  it("renders the full README line (em-dash + tier icon + brand) even with only slot/provider/model", () => {
    const line = sf.buildResilientFooterLine({
      activeSlot: "medium",
      providerLabel: "OpenCode Go",
      modelName: "Mimo V2.5",
    })
    assert.equal(typeof line, "string")
    assert.ok(line.startsWith("—"), "must open with the em-dash README wrapper")
    assert.ok(line.trimEnd().endsWith("—"), "must close with the em-dash README wrapper")
    assert.ok(line.includes("◐"), "must carry the README tier icon for medium")
    // The whole point: the degrade path is NOT the old 3-segment line.
    assert.ok(
      /vibeOS|Vibe/.test(line),
      "the one footer always carries the footer product brand — never a bare provider|model line",
    )
  })

  it("never throws on empty / partial / garbage input (this is why it survives every turn)", () => {
    assert.doesNotThrow(() => sf.buildResilientFooterLine({}))
    assert.doesNotThrow(() => sf.buildResilientFooterLine(null))
    assert.doesNotThrow(() => sf.buildResilientFooterLine(undefined))
    assert.doesNotThrow(() => sf.buildResilientFooterLine({ ltTotal: "not-a-number", enfTags: null } as any))
    const line = sf.buildResilientFooterLine(undefined)
    assert.ok(line.includes("—"), "even with no input it returns the README footer wrapper")
  })

  it("carries the alert through the degrade path (alert is part of the one footer)", () => {
    const line = sf.buildResilientFooterLine({
      activeSlot: "cheap",
      providerLabel: "OpenCode",
      modelName: "Big Pickle",
      alertTag: "⚠ model drift",
    })
    assert.ok(line.includes("⚠ model drift"), "the alert must appear on the degraded line too")
  })
})

describe("footer SSOT — alert placement in the canonical builder", () => {
  it("buildFooterLine puts the alert in README position (after enforcement, before stress gauge)", () => {
    const line = sf.buildFooterLine({
      activeSlot: "cheap",
      providerLabel: "DeepSeek",
      modelName: "v4-flash",
      ltTotal: 0,
      vibeBrand: "VibeUltraX",
      optMode: "vibeultrax",
      flashIcon: " ⚡",
      enfTags: ["[ENF ON]"],
      stressGauge: "▁",
      alertTag: "⚠ api degraded",
    })
    const alertIdx = line.indexOf("⚠ api degraded")
    const guardIdx = line.indexOf("guarded")
    const stressIdx = line.lastIndexOf("▁")
    assert.ok(alertIdx > -1, "alert must render")
    assert.ok(guardIdx > -1 && guardIdx < alertIdx, "alert comes after enforcement tags")
    assert.ok(stressIdx > alertIdx, "alert comes before the stress gauge")
  })
})

describe("footer SSOT — resolveFooterState shared resolver contract", () => {
  it("resolveFooterState is exported and is a function", () => {
    assert.equal(typeof (sf as any).resolveFooterState, "function", "resolveFooterState must exist in shared-footer")
  })

  it("resolveFooterState returns a FooterLineInput-compatible object with defaults for missing fields", () => {
    const state = (sf as any).resolveFooterState({
      activeSlot: "cheap",
      providerLabel: "OpenCode",
      modelName: "Big Pickle",
      vibeBrand: "vibeOS",
    })
    assert.equal(typeof state, "object")
    assert.equal(state.activeSlot, "cheap")
    assert.equal(state.providerLabel, "OpenCode")
    assert.equal(state.modelName, "Big Pickle")
    assert.equal(state.vibeBrand, "vibeOS")
    // Defaults
    assert.equal(typeof state.savingsTotal, "number")
    assert.equal(typeof state.optMode, "string")
    assert.ok(Array.isArray(state.enfTags))
  })

  it("resolveFooterState preserves overridden fields", () => {
    const state = (sf as any).resolveFooterState({
      activeSlot: "brain",
      providerLabel: "DeepSeek",
      modelName: "v4-pro",
      vibeBrand: "VibeQMaX",
      optMode: "quality",
      savingsTotal: 12.57,
      ltTrend: "up",
      enfTags: ["[ENF ON]"],
      subRegime: "CONVERGING",
      cascadeIcon: "▸▸▸",
      alertTag: "⚠ api slow",
      stressGauge: "▅",
    })
    assert.equal(state.activeSlot, "brain")
    assert.equal(state.savingsTotal, 12.57)
    assert.equal(state.optMode, "quality")
    assert.deepEqual(state.enfTags, ["[ENF ON]"])
    assert.equal(state.subRegime, "CONVERGING")
    assert.equal(state.cascadeIcon, "▸▸▸")
    assert.equal(state.alertTag, "⚠ api slow")
  })

  it("resolveFooterState output is directly consumable by buildFooterLine and buildResilientFooterLine", () => {
    const state = (sf as any).resolveFooterState({
      activeSlot: "medium",
      providerLabel: "DeepSeek",
      modelName: "v4-flash",
      vibeBrand: "VibeUltraX",
      optMode: "vibeultrax",
      savingsTotal: 42.0,
      enfTags: ["[TDD ON]", "[FLOW ON]"],
      cascadeIcon: "▸▸",
      alertTag: "⚠ switch pending",
      stressGauge: "▃",
    })
    const richLine = sf.buildFooterLine(state)
    const resilientLine = sf.buildResilientFooterLine(state)
    // Both must produce valid README footer lines
    assert.ok(richLine.startsWith("—"), "rich line opens with em-dash")
    assert.ok(richLine.trimEnd().endsWith("—"), "rich line closes with em-dash")
    assert.ok(resilientLine.startsWith("—"), "resilient line opens with em-dash")
    assert.ok(resilientLine.trimEnd().endsWith("—"), "resilient line closes with em-dash")
    // Both must carry the alert
    assert.ok(richLine.includes("⚠ switch pending"), "rich line carries alert")
    assert.ok(resilientLine.includes("⚠ switch pending"), "resilient line carries alert")
    // Both must carry enforcement
    assert.ok(richLine.includes("tests live"), "rich line carries enforcement")
    assert.ok(resilientLine.includes("tests live"), "resilient line carries enforcement")
  })

  it("resolveFooterState builds a FooterLineInput that buildFooterLine renders without throwing", () => {
    const state = (sf as any).resolveFooterState({
      activeSlot: "cheap",
      providerLabel: "DeepSeek",
      modelName: "v4-flash",
      vibeBrand: "VibeMaX",
    })
    assert.doesNotThrow(() => sf.buildFooterLine(state))
    assert.doesNotThrow(() => sf.buildResilientFooterLine(state))
  })
})
