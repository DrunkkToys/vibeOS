// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveCascadeRouteDecision } from "../src/lib/hooks/tool-execute.js"

test("cascade route decision returns a live selected model and route path", () => {
  const decision = resolveCascadeRouteDecision({
    prompt: "check the logs",
    firstWord: "check",
    currentTier: "budget",
    currentModel: "opencode/big-pickle",
    trinityCheap: "opencode/big-pickle",
    trinityMedium: "opencode-go/mimo-v2.5",
    trinityBrain: "deepseek/deepseek-v4-flash",
    activePipeline: ["cheap", "medium", "brain"],
    stressScore: 0.1,
  })

  assert.equal(decision.selectedSlot, "cheap")
  assert.equal(decision.selectedModel, "opencode/big-pickle")
  assert.deepEqual(decision.routePath, ["cheap"])
  assert.equal(decision.source, "ml")
})

test("cascade route decision remains deterministic for the same live input", () => {
  const input = {
    prompt: "implement the fix",
    firstWord: "implement",
    currentTier: "high",
    currentModel: "deepseek/deepseek-v4-flash",
    trinityCheap: "opencode/big-pickle",
    trinityMedium: "opencode-go/mimo-v2.5",
    trinityBrain: "deepseek/deepseek-v4-flash",
    activePipeline: ["cheap", "medium", "brain"],
    stressScore: 0.2,
  }
  const first = resolveCascadeRouteDecision(input)
  const second = resolveCascadeRouteDecision(input)
  assert.deepEqual(second, first)
})
