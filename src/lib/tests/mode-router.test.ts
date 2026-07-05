import { describe, it } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../turn-classify.js?mode-router=" + Date.now())

type OptimizationMode = string

describe("mode-router — autoSelectMode", () => {
  it("returns quality for LOOPING regime", () => {
    assert.equal(mod.autoSelectMode("LOOPING", 0.1), "quality")
  })

  it("returns quality for CONVERGING regime", () => {
    assert.equal(mod.autoSelectMode("CONVERGING", 0.1), "quality")
  })

  it("returns quality for CLOSED regime", () => {
    assert.equal(mod.autoSelectMode("CLOSED", 0.1), "quality")
  })

  it("returns quality for INIT regime", () => {
    assert.equal(mod.autoSelectMode("INIT", 0.2), "quality")
  })

  it("returns quality for REFINING regime with high stress", () => {
    assert.equal(mod.autoSelectMode("REFINING", 1.8), "quality")
  })

  it("returns quality for unknown regime", () => {
    assert.equal(mod.autoSelectMode("DIVERGENT", 0.1), "quality")
  })

  it("handles undefined regime", () => {
    assert.equal(mod.autoSelectMode(undefined, 0.1), "quality")
  })
})

describe("mode-router — resolveOptimizationMode", () => {
  it("delegates to autoSelectMode when mode is auto", () => {
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "auto"), "quality")
    assert.equal(mod.resolveOptimizationMode("CONVERGING", 0.1, "auto"), "quality")
    assert.equal(mod.resolveOptimizationMode("DIVERGENT", 0.1, "auto"), "quality")
  })

  it("passes through explicit modes unchanged", () => {
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "speed"), "speed")
    assert.equal(mod.resolveOptimizationMode("CONVERGING", 0.1, "quality"), "quality")
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "budget"), "budget")
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "balanced"), "balanced")
  })

  it("passes through vibeultrax mode", () => {
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "vibeultrax"), "vibeultrax")
  })

  it("falls back to budget for unsupported modes", () => {
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, "nonexistent"), "budget")
  })

  it("handles empty/undefined mode as auto", () => {
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, ""), "quality")
    assert.equal(mod.resolveOptimizationMode("LOOPING", 0.1, undefined), "quality")
  })
})

describe("mode-router — resolveOptimizationSlot", () => {
  it("maps brain-root modes to brain", () => {
    assert.equal(mod.resolveOptimizationSlot("quality"), "brain")
    assert.equal(mod.resolveOptimizationSlot("vibeqmax"), "brain")
  })

  it("maps medium-root modes to medium", () => {
    assert.equal(mod.resolveOptimizationSlot("speed"), "medium")
    assert.equal(mod.resolveOptimizationSlot("vibemax"), "medium")
    assert.equal(mod.resolveOptimizationSlot("vibelitex"), "medium")
  })

  it("maps cheap-root modes to cheap", () => {
    assert.equal(mod.resolveOptimizationSlot("budget"), "cheap")
    assert.equal(mod.resolveOptimizationSlot("balanced"), "cheap")
  })

  it("maps longrun to brain root", () => {
    assert.equal(mod.resolveOptimizationSlot("longrun"), "brain")
  })

  it("defaults unknown modes to cheap", () => {
    assert.equal(mod.resolveOptimizationSlot("unknown_mode"), "cheap")
  })
})

describe("mode-router — classifyTurnSimple", () => {
  it("classifies qna intents as EXPLORING", () => {
    assert.equal(mod.classifyTurnSimple("how do I wire this up?"), "EXPLORING")
    assert.equal(mod.classifyTurnSimple("what is this code doing?"), "EXPLORING")
  })

  it("classifies implementation intents as REFINING", () => {
    assert.equal(mod.classifyTurnSimple("fix this regression"), "REFINING")
    assert.equal(mod.classifyTurnSimple("add a new feature"), "REFINING")
  })

  it("classifies empty text as INIT", () => {
    assert.equal(mod.classifyTurnSimple(""), "INIT")
  })
})
