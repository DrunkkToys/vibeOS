import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeReward } from "../src/vibeOS-lib/reward-engine.js"

describe("PR #274 — reward engine credits and persistence", () => {
  it("positive outcome yields quality reward credits", () => {
    const result = computeReward({
      outcome: "positive",
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0,
    })
    assert.equal(result.breakdown.qualityReward, 10, "positive outcome = +10 quality reward")
    assert.ok(result.credits > 0, "total credits must be positive")
  })

  it("negative outcome with unsupported claims triggers claim penalty", () => {
    const result = computeReward({
      outcome: "negative",
      claims: [{ line: 1, text: "works perfectly", pattern: "works" }],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0,
    })
    assert.equal(result.breakdown.liePenalty, -15, "unsupported completion claim = -15")
    assert.ok(result.credits < 0, "total credits must be negative")
  })

  it("negative outcome without claims has no claim penalty", () => {
    const result = computeReward({
      outcome: "negative",
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0,
    })
    assert.equal(result.breakdown.liePenalty, 0, "no claims = no claim penalty")
  })

  it("saving bonus tiers work correctly", () => {
    const small = computeReward({
      outcome: null,
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0.001,
    })
    assert.equal(small.breakdown.savingBonus, 1, "savings >= 0.001 = +1")

    const mid = computeReward({
      outcome: null,
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0.01,
    })
    assert.equal(mid.breakdown.savingBonus, 2, "savings >= 0.01 = +2")

    const large = computeReward({
      outcome: null,
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0.05,
    })
    assert.equal(large.breakdown.savingBonus, 3, "savings >= 0.05 = +3")
  })

  it("laziness penalties accumulate correctly", () => {
    const result = computeReward({
      outcome: null,
      claims: [],
      laziness: { shortOutput: true, todoPlaceholders: true, skippedDelegation: true, penalty: 0 },
      savingsUsd: 0,
    })
    assert.equal(
      result.breakdown.lazinessPenalty,
      -5 + -15 + -5,
      "shortOutput(-5) + todos(-15) + skippedDelegation(-5) = -25"
    )
  })

  it("contradiction detection adds penalty", () => {
    const result = computeReward({
      outcome: null,
      claims: [],
      laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0,
      contradictionDetected: true,
    })
    assert.equal(result.breakdown.contradictionPenalty, -10, "contradiction = -10")
  })

  it("credits sum matches breakdown", () => {
    const result = computeReward({
      outcome: "positive",
      claims: [{ line: 1, text: "claim", pattern: "pat" }],
      laziness: { shortOutput: true, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
      savingsUsd: 0.1,
      contradictionDetected: true,
    })
    const expected =
      result.breakdown.qualityReward +
      result.breakdown.savingBonus +
      result.breakdown.liePenalty +
      result.breakdown.contradictionPenalty +
      result.breakdown.lazinessPenalty +
      result.breakdown.metaWorkPenalty
    assert.equal(result.credits, expected, "credits must equal sum of breakdown fields")
  })
})
