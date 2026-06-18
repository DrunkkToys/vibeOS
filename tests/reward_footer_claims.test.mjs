// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildRewardInput } from "../src/lib/hooks/footer.js"
import { computeReward } from "../src/vibeOS-lib/reward-engine.js"

test("footer reward wiring: claim mismatch reaches the lie penalty", () => {
  const input = buildRewardInput({
    finalOutcome: "negative",
    assistantText: "I fixed the bug, rebuilt the pipeline, and verified the release against the regression suite. The issue is resolved and the deployment is complete.",
    userText: "It still doesn't work.",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: true,
  })

  assert.ok(input.claims.length > 0, "the footer should forward claim evidence")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, -15)
})

test("footer reward wiring: no mismatch keeps claim penalty out", () => {
  const input = buildRewardInput({
    finalOutcome: "negative",
    assistantText: "I fixed the bug, rebuilt the pipeline, and verified the release against the regression suite. The issue is resolved and the deployment is complete.",
    userText: "Thanks, that matches what I expected.",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: true,
  })

  assert.equal(input.claims.length, 0, "the footer should not invent claim evidence")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, 0)
})

test("footer reward wiring: empty inputs stay safe and only hit laziness", () => {
  const input = buildRewardInput({
    finalOutcome: null,
    assistantText: "",
    userText: "",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: false,
  })

  assert.equal(input.claims.length, 0, "empty output should not invent claim evidence")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, 0)
  assert.equal(result.breakdown.lazinessPenalty, -5)
  assert.equal(result.credits, -5)
})
