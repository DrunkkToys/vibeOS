// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { buildRewardInput } from "../src/lib/hooks/footer.js"
import { evaluateClaimVerification } from "../src/lib/claim-verification.js"
import { computeReward } from "../src/vibeOS-lib/reward-engine.js"

test("footer reward wiring: contradicted completion claim reaches the claim penalty", () => {
  const input = buildRewardInput({
    finalOutcome: "negative",
    assistantText: "I fixed the bug, rebuilt the pipeline, and verified the release against the regression suite. The issue is resolved and the deployment is complete.",
    userText: "It still doesn't work.",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: true,
    sessionId: "test-contradicted-claim",
  })

  assert.ok(input.claims.length > 0, "the footer should forward claim evidence")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, -15)
})

test("footer reward wiring: unsupported completion claims still reach the claim penalty", () => {
  const input = buildRewardInput({
    finalOutcome: "negative",
    assistantText: "I fixed the bug, rebuilt the pipeline, and verified the release against the regression suite. The issue is resolved and the deployment is complete.",
    userText: "Thanks, that matches what I expected.",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: true,
    sessionId: "test-unsupported-claim",
  })

  assert.ok(input.claims.length > 0, "unsupported completion claims should still be forwarded")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, -15)
})

test("footer reward wiring: empty inputs stay safe and only hit laziness", () => {
  const input = buildRewardInput({
    finalOutcome: null,
    assistantText: "",
    userText: "",
    prevAssistantTexts: [],
    savingsUsd: 0,
    isBrainTier: false,
    sessionId: "test-empty-claim",
  })

  assert.equal(input.claims.length, 0, "empty output should not invent claim evidence")

  const result = computeReward(input)
  assert.equal(result.breakdown.liePenalty, 0)
  assert.equal(result.breakdown.lazinessPenalty, -5)
  assert.equal(result.credits, -5)
})

test("claim verification adds an explicit verify nudge when claims are unsubstantiated", () => {
  const vibeHome = join(tmpdir(), `vibeos-claims-${Date.now()}`)
  const result = evaluateClaimVerification({
    text: "I fixed the bug and verified the release.",
    vibeHome,
  })

  assert.equal(result.status, "unsupported")
  assert.equal(result.unsubstantiatedCount, 1)
  assert.match(result.claimTag, /verify/)
})
