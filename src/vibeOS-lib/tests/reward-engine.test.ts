import test from "node:test"
import assert from "node:assert/strict"

const reward = await import("../reward-engine.js?test=" + Date.now())

test("reward-engine: positive outcome yields +10 credits", () => {
  const result = reward.computeReward({
    outcome: "positive",
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, 10)
  assert.equal(result.breakdown.qualityReward, 10)
})

test("reward-engine: negative outcome yields 0 credits", () => {
  const result = reward.computeReward({
    outcome: "negative",
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, 0)
})

test("reward-engine: smart saving yields +1-3 bonus", () => {
  const small = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0.001,
  })
  assert.ok(small.credits >= 1 && small.credits <= 3, `small savings bonus: ${small.credits}`)
  assert.ok(small.breakdown.savingBonus >= 1)

  const large = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0.05,
  })
  assert.equal(large.breakdown.savingBonus, 3)
})

test("reward-engine: lie claim-vs-outcome mismatch yields -15", () => {
  const result = reward.computeReward({
    outcome: "negative",
    claims: [{ line: 1, text: "I fixed the bug", pattern: "fix" }],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, -15)
  assert.equal(result.breakdown.liePenalty, -15)
})

test("reward-engine: laziness TODO/placeholders yields -15", () => {
  const result = reward.computeReward({
    outcome: "positive",
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: true, skippedDelegation: false, penalty: 15 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, -5)
  assert.equal(result.breakdown.lazinessPenalty, -15)
})

test("reward-engine: laziness short output yields -5", () => {
  const result = reward.computeReward({
    outcome: "positive",
    claims: [],
    laziness: { shortOutput: true, todoPlaceholders: false, skippedDelegation: false, penalty: 5 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, 5)
  assert.equal(result.breakdown.lazinessPenalty, -5)
})

test("reward-engine: laziness skipped delegation yields -5", () => {
  const result = reward.computeReward({
    outcome: "positive",
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: true, penalty: 5 },
    savingsUsd: 0,
  })
  assert.equal(result.credits, 5)
  assert.equal(result.breakdown.lazinessPenalty, -5)
})

test("reward-engine: multiple penalties stack", () => {
  const result = reward.computeReward({
    outcome: "negative",
    claims: [{ line: 1, text: "I fixed the bug", pattern: "fix" }],
    laziness: { shortOutput: true, todoPlaceholders: true, skippedDelegation: false, penalty: 20 },
    savingsUsd: 0,
  })
  assert.equal(result.breakdown.qualityReward, 0)
  assert.equal(result.breakdown.liePenalty, -15)
  assert.equal(result.breakdown.lazinessPenalty, -20)
  assert.equal(result.credits, -35)
})

test("reward-engine: self-contradiction lie yields -10", () => {
  const result = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
    contradictionDetected: true,
  })
  assert.equal(result.credits, -10)
  assert.equal(result.breakdown.contradictionPenalty, -10)
})

test("reward-engine: cache hit yields +2 credits", () => {
  const result = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
    cacheHit: true,
  })
  assert.equal(result.credits, 2)
  assert.equal(result.breakdown.cachePenalty, 2)
})

test("reward-engine: cache miss yields -2 credits", () => {
  const result = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
    cacheMiss: true,
  })
  assert.equal(result.credits, -2)
  assert.equal(result.breakdown.cachePenalty, -2)
})

test("reward-engine: no cache event yields 0 cache penalty", () => {
  const result = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
  })
  assert.equal(result.breakdown.cachePenalty, 0)
  assert.equal(result.credits, 0)
})

test("reward-engine: cache hit stacks with quality and saving rewards", () => {
  const result = reward.computeReward({
    outcome: "positive",
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0.05,
    cacheHit: true,
  })
  assert.equal(result.breakdown.qualityReward, 10)
  assert.equal(result.breakdown.savingBonus, 3)
  assert.equal(result.breakdown.cachePenalty, 2)
  assert.equal(result.credits, 15)
})

test("reward-engine: cache hit+miss both true treats as hit", () => {
  const result = reward.computeReward({
    outcome: null,
    claims: [],
    laziness: { shortOutput: false, todoPlaceholders: false, skippedDelegation: false, penalty: 0 },
    savingsUsd: 0,
    cacheHit: true,
    cacheMiss: true,
  })
  assert.equal(result.breakdown.cachePenalty, 2)
  assert.equal(result.credits, 2)
})
