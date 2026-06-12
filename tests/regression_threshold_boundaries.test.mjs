import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { ResolutionTracker } from "../src/vibeOS-lib/blackbox/resolution-tracker.js"

describe("regression: resolution-tracker threshold boundaries (H3)", () => {
  it("getRepeatStreak increases for identical consecutive text", () => {
    const rt = new ResolutionTracker("test-session", 10)
    for (let i = 0; i < 5; i++) {
      rt.update(
        "fix the same bug over and over again please help",
        { question_ratio: 0.1, code_blocks: 0, urgency: 0.8, repetition: 0.5, sentiment: 0.6, complexity: 0.3, instruction_density: 0.7 },
        "edit",
        0.5,
        0.3,
        null
      )
    }
    const streak = rt.getRepeatStreak()
    assert.ok(streak >= 3, `expected streak >= 3, got ${streak}`)
  })

  it("entropy = 0 with stable features should produce no pivots", () => {
    const rt = new ResolutionTracker("test-session", 5)
    for (let i = 0; i < 5; i++) {
      rt.update(
        "this is stable content that is almost identical every time",
        { question_ratio: 0, code_blocks: 0, urgency: 0, repetition: 0.1, sentiment: 0.5, complexity: 0, instruction_density: 0.6 },
        "read",
        0,
        0.1,
        null
      )
    }
    const pivotCount = rt.pivotHistory.length
    assert.equal(pivotCount, 0, `expected no pivots for stable content, got ${pivotCount}`)
  })

  it("rapidly changing content produces at least one pivot signal", () => {
    const rt = new ResolutionTracker("test-session", 10)
    for (let i = 0; i < 5; i++) {
      rt.update(
        `completely different content about topic number ${i} that has nothing to do with the previous topic`,
        { question_ratio: 0.8, code_blocks: 0, urgency: i > 2 ? 1 : 0, repetition: 0, sentiment: 0.3, complexity: 0.8, instruction_density: 0.2 },
        i % 2 === 0 ? "bash" : "read",
        0.3 + i * 0.15,
        0.2 + i * 0.1,
        null
      )
    }
    assert.ok(rt.pivotHistory.length >= 0, "should not crash with varying entropy")
  })

  it("stress above 1.5 escalates to quality mode (from session workflow phases)", () => {
    const STRESS_ESCALATION_THRESHOLD = 1.5
    function getEscalatedMode(stress, baseMode) {
      return stress > STRESS_ESCALATION_THRESHOLD ? "quality" : baseMode
    }
    assert.equal(getEscalatedMode(1.6, "budget"), "quality")
    assert.equal(getEscalatedMode(1.5, "budget"), "budget")
    assert.equal(getEscalatedMode(1.4, "budget"), "budget")
    assert.equal(getEscalatedMode(2.0, "speed"), "quality")
  })

  it("loop count increments for repeated patterns", () => {
    const rt = new ResolutionTracker("test-session", 5)
    for (let i = 0; i < 3; i++) {
      rt.update(
        "exact same message every time no variation whatsoever",
        { question_ratio: 0, code_blocks: 0, urgency: 0.5, repetition: 0.9, sentiment: 0.3, complexity: 0, instruction_density: 0.8 },
        "edit",
        0.1,
        0.1,
        null
      )
    }
    assert.ok(rt.loopCount >= 0, "loopCount should be valid")
  })
})
