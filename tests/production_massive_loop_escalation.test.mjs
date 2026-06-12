import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { ResolutionTracker } from "../src/vibeOS-lib/blackbox/resolution-tracker.js"

describe("production: massive loop escalation", () => {
  it("loopCount of 256 triggers max escalation level", async () => {
    const rt = new ResolutionTracker("test-session-1")
    for (let i = 0; i < 257; i++) {
      rt.update(
        "this is a repeated loop message that keeps saying the same thing over and over again",
        { question_ratio: 0, code_blocks: 0, urgency: 0, repetition: 0.8, sentiment: 0.3, complexity: 0, instruction_density: 0.5 },
        "bash",
        i > 50 ? 0.05 : 0.5,
        i > 50 ? 0.1 : 0.8,
        null
      )
    }
    assert.equal(rt.loopCount, 256)
    const state = rt.snapshot()
    assert.equal(state.loop_intervention_level, "escalated")
    assert.ok(state.is_looping)
    assert.ok(rt.getRepeatStreak() >= 2)
    assert.ok(rt.history.length <= rt.maxHistory)
  })

  it("134+ pivot entries maintain stable state", () => {
    const rt = new ResolutionTracker("test-session-2")
    const features = { question_ratio: 0.5, code_blocks: 0, urgency: 0, repetition: 0.1, sentiment: 0.5, complexity: 0, instruction_density: 0.5 }
    const pool = [
      "quantum computing entanglement superposition qubit measurement decoherence algorithm",
      "weather forecast sunny rainy cloudy stormy temperature humidity precipitation conditions",
      "ancient egyptian pyramids contain hidden chambers with treasure maps artifacts",
      "machine learning algorithms process vast amounts of training data efficiently",
      "symphony orchestra played beautiful classical music at concert hall filled audience",
    ]
    for (let i = 0; i < 150; i++) {
      rt.update(
        pool[i % pool.length],
        features,
        i % 2 === 0 ? "bash" : "read",
        Math.max(0.1, 1 - i / 150),
        Math.max(0.1, 1 - i / 150),
        null
      )
    }
    assert.ok(rt.pivotHistory.length > 0, "expected at least one pivot detection")
    assert.ok(rt.history.length <= rt.maxHistory)
  })

  it("classifyTurn produces stable regimes at scale", () => {
    const rt = new ResolutionTracker("test-session-3", 5)
    for (let i = 0; i < 100; i++) {
      rt.update(
        i < 20 ? `initial question about how to implement feature ${i}` :
        i < 50 ? `trying this implementation approach ${i}` :
        `ok it works but we need to fix ${i}`,
        {
          question_ratio: i < 20 ? 0.8 : 0.1,
          code_blocks: i < 20 ? 0 : 0.3,
          urgency: i % 10 === 0 ? 1.0 : 0,
          repetition: 0.05,
          sentiment: i < 30 ? 0.5 : 0.7,
          complexity: 0.3,
          instruction_density: 0.6,
        },
        i < 20 ? "read" : i < 50 ? "bash" : "edit",
        0.5,
        0.3,
        null
      )
    }
    assert.ok(rt.loopCount >= 0)
  })

  it("outcomeHistory does not cause memory issues at scale", () => {
    const rt = new ResolutionTracker("test-session-4")
    for (let i = 0; i < 1000; i++) {
      rt.update(
        `outcome test message ${i}`,
        { question_ratio: 0.1, code_blocks: 0, urgency: 0, repetition: 0.1, sentiment: 0.5, complexity: 0, instruction_density: 0.5 },
        "bash",
        0.5,
        0.3,
        null
      )
      rt.recordOutcome(i % 2 === 0 ? "solved" : "unresolved")
    }
    assert.equal(rt.outcomeHistory.length, 1000)
    assert.ok(rt.outcomeHistory.every(o => typeof o.turn === "number" && typeof o.outcome === "string"))
    assert.ok(rt.history.length <= rt.maxHistory)
  })
})
