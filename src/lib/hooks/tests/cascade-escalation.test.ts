import { describe, it } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../../../vibeOS-lib/ml-router.js?cascade-escalation=" + Date.now())
const bbMod = await import("../../turn-classify.js?cascade-escalation-bb=" + Date.now())

describe("cascade escalation — cascadeDecide", () => {
  it("returns useCheap=true for simple prompts with high confidence", () => {
    const result = mod.cascadeDecide("list the files in src/", 0.001, 0.005, 0.02, 0.85)
    assert.equal(result.useCheap, true)
    assert.equal(result.level, "simple")
    assert.ok(result.confidence >= 0.7)
  })

  it("returns escalate=true for complex prompts (with potential cascade)", () => {
    const result = mod.cascadeDecide("refactor the entire authentication module to use OAuth2 with PKCE flow", 0.001, 0.005, 0.02, 0.85)
    assert.equal(result.escalate, true)
    assert.equal(typeof result.useCheap, "boolean")
    assert.equal(typeof result.estimatedSavings, "number")
  })

  it("returns reasonable confidence values for moderate prompts", () => {
    const result = mod.cascadeDecide("add input validation to the form handler", 0.001, 0.005, 0.02, 0.85)
    assert.ok(result.confidence >= 0 && result.confidence <= 1)
    assert.ok(typeof result.reason === "string")
  })

  it("returns estimatedSavings as a non-negative number", () => {
    const result = mod.cascadeDecide("simple task", 0.001, 0.005, 0.02, 0.85)
    assert.ok(result.estimatedSavings >= 0)
    assert.ok(typeof result.estimatedSavings === "number")
  })

  it("handles extremely long prompts gracefully", () => {
    const longPrompt = "a".repeat(10000)
    const result = mod.cascadeDecide(longPrompt, 0.001, 0.005, 0.02, 0.85)
    assert.ok(["simple", "moderate", "complex"].includes(result.level))
  })

  it("handles empty prompt", () => {
    const result = mod.cascadeDecide("", 0.001, 0.005, 0.02, 0.85)
    assert.ok(result.escalate === false || result.escalate === true)
  })
})

describe("cascade escalation — bb resolveOptimizationSlot", () => {
  it("routes vibeultrax to brain root (cascade pipeline starts cheap, resolves brain)", () => {
    assert.equal(bbMod.resolveOptimizationSlot("vibeultrax"), "brain")
  })

  it("routes quality to brain", () => {
    assert.equal(bbMod.resolveOptimizationSlot("quality"), "brain")
  })

  it("routes speed to medium", () => {
    assert.equal(bbMod.resolveOptimizationSlot("speed"), "medium")
  })

  it("routes budget to cheap", () => {
    assert.equal(bbMod.resolveOptimizationSlot("budget"), "cheap")
  })
})
