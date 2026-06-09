// SPDX-License-Identifier: MIT
// Integration test: agent_mode is regime-driven, not mode-driven
import { test } from "node:test"
import assert from "node:assert/strict"

const turn = await import("../src/lib/turn-classify.js?agent-test=" + Date.now())

// ── agent_mode: plan only for complex regimes ──
test("agent_mode: REFINING + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, "plan")
})

test("agent_mode: CONVERGING + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CONVERGING", latest_stress_multiplier: 0 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, "plan")
})

test("agent_mode: CLOSED + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CLOSED", latest_stress_multiplier: 0 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, "plan")
})

// ── agent_mode: NOT plan for simple regimes ──
test("agent_mode: EXPLORING + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: DIVERGENT + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "DIVERGENT", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: INIT + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "INIT", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: LOOPING + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "LOOPING", latest_stress_multiplier: 0 },
    undefined, "speed"
  )
  assert.equal(cv.agent_mode, undefined)
})

// ── agent_mode: stress > 1.5 blocks plan ──
test("agent_mode: REFINING + high stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 1.8 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: CONVERGING + high stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CONVERGING", latest_stress_multiplier: 1.8 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, undefined)
})

// ── Full chain: QA query should NOT trigger plan ──
test("full chain: 'hi' → INIT → agent_mode undefined", () => {
  const regime = turn.classifyTurnSimple("hi")
  const mode = turn.autoSelectMode(regime, 0)
  const cv = turn.computeControlVector(
    { sub_regime: regime, latest_stress_multiplier: 0 },
    undefined, mode
  )
  assert.equal(cv.agent_mode, undefined)
})

test("full chain: 'fix production bug' → REFINING → agent_mode plan", () => {
  const regime = turn.classifyTurnSimple("fix this production bug")
  const mode = turn.autoSelectMode(regime, 0)
  const cv = turn.computeControlVector(
    { sub_regime: regime, latest_stress_multiplier: 0 },
    undefined, mode
  )
  assert.equal(cv.agent_mode, "plan")
})

// ── Verify other CV fields unaffected ──
test("CV: enforcement_mode still present", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.ok(cv.enforcement_mode)
  assert.ok(cv.flow_mode)
  assert.ok(cv.tdd_mode)
  assert.ok(cv.tier_bias)
})

test("CV: optimization_mode still present", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.ok(cv.optimization_mode)
})
