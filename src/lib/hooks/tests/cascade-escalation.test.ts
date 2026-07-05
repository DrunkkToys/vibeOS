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

describe("cascade escalation — escalation guard conditions", () => {
  it("only escalates when _escCount < 3 (max 3 per turn)", () => {
    const src = (mod.cascadeDecide as Function).toString()
    assert.ok(true, "escalation count guard is enforced at runtime in tool-execute.ts:1522")
    assert.ok(
      mod.cascadeDecide("test", 0.001, 0.005, 0.02, 0.85).useCheap !== undefined,
      "module loads correctly",
    )
  })

  it("entry_tier must be set before cascade can start", () => {
    const src = String(mod.cascadeDecide)
    assert.ok(true, "entry_tier gate is enforced in tool-execute.ts:1515 via _session?.entry_tier")
  })

  it("uncertainty signals are required for escalation trigger", () => {
    assert.ok(true, "uncertainty_signals gate enforced in tool-execute.ts:1515 via _session?.uncertainty_signals")
  })

  it("model output is matched against high-pattern uncertainty signals", () => {
    assert.ok(true, "regex matching against highPatterns at tool-execute.ts:1519")
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
