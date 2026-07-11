// SPDX-License-Identifier: MIT
// DEEP TEST 3: Blackbox — getBlackboxResolution contract
// getBlackboxResolution() returns the tracker's snapshot. The tracker is initialized
// by the plugin, so it always returns a valid object (never null in normal operation).
// Stateful loop detection lives in ResolutionTracker (blackbox_local_loop_authority.test.mjs covers it).
import test from "node:test"
import assert from "node:assert/strict"

const mod = await import("../dist/vibeOS.js")
const { getBlackboxResolution } = mod

test("blackbox: getBlackboxResolution returns a snapshot object", () => {
  const result = getBlackboxResolution()
  assert.ok(result !== null && typeof result === "object", "result is a non-null object")
  assert.ok("sub_regime" in result, "has sub_regime field")
  assert.ok("is_looping" in result, "has is_looping field")
  assert.ok("loop_consecutive" in result, "has loop_consecutive field")
  assert.ok("resolution" in result, "has resolution field")
})

test("blackbox: fresh snapshot starts at INIT regime", () => {
  const result = getBlackboxResolution()
  assert.equal(result.sub_regime, "INIT", "default is INIT")
})

test("blackbox: is_looping defaults to false", () => {
  const result = getBlackboxResolution()
  assert.equal(result.is_looping, false, "not looping by default")
})

test("blackbox: loop_consecutive is a non-negative number", () => {
  const result = getBlackboxResolution()
  assert.equal(typeof result.loop_consecutive, "number", "loop_consecutive is number")
  assert.ok(result.loop_consecutive >= 0, "loop_consecutive >= 0")
})

test("blackbox: continuity_state is one of expected values", () => {
  const result = getBlackboxResolution()
  const valid = ["HIGH", "MEDIUM", "LOW", "BROKEN", "UNKNOWN"]
  assert.ok(valid.includes(result.continuity_state),
    "continuity_state is valid: " + result.continuity_state)
})

test("blackbox: resolution is a non-empty string", () => {
  const result = getBlackboxResolution()
  assert.equal(typeof result.resolution, "string", "resolution is string")
  assert.ok(result.resolution.length > 0, "resolution is non-empty")
})

test("blackbox: signals object has expected fields", () => {
  const result = getBlackboxResolution()
  assert.ok(result.signals, "has signals object")
  assert.ok("action_consistency" in result.signals, "signals has action_consistency")
  assert.ok("entropy_trend" in result.signals, "signals has entropy_trend")
})

test("blackbox: intent_state has expected fields", () => {
  const result = getBlackboxResolution()
  assert.ok(result.intent_state, "has intent_state")
  assert.ok("volatility_score" in result.intent_state, "intent_state has volatility_score")
  assert.ok("drift_rate" in result.intent_state, "intent_state has drift_rate")
})
