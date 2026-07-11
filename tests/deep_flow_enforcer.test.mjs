// SPDX-License-Identifier: MIT
// DEEP TEST 1: Flow enforcer — DelegationEnforcer + applySlot + enforcement toggle
import test from "node:test"
import assert from "node:assert/strict"

const mod = await import("../dist/vibeOS.js")
const { DelegationEnforcer, applySlot, _setEnforcementBlockedForTest, _resetTrinitySlotsForTest } = mod

test("flow: DelegationEnforcer returns object", () => {
  const result = DelegationEnforcer()
  assert.equal(typeof result, "object", "DelegationEnforcer returns object")
  assert.ok(result !== null, "result is not null")
})

test("flow: applySlot with brain tier returns ok:true", () => {
  _resetTrinitySlotsForTest()
  const result = applySlot("brain", "deepseek/deepseek-v4-pro")
  assert.equal(result.ok, true, "applySlot returns ok:true")
  assert.ok(result.ocModel, "ocModel is set")
})

test("flow: applySlot with cheap tier returns ok:true", () => {
  _resetTrinitySlotsForTest()
  const result = applySlot("cheap", "deepseek/deepseek-chat")
  assert.equal(result.ok, true, "applySlot returns ok:true for cheap")
})

test("flow: applySlot with medium tier returns ok:true", () => {
  _resetTrinitySlotsForTest()
  const result = applySlot("medium", "deepseek/deepseek-chat")
  assert.equal(result.ok, true, "applySlot returns ok:true for medium")
})

test("flow: _setEnforcementBlockedForTest toggles enforcement without crash", () => {
  _resetTrinitySlotsForTest()
  _setEnforcementBlockedForTest(true)
  const result = applySlot("brain", "deepseek/deepseek-v4-pro")
  assert.ok(result, "applySlot works after blocking enforcement")
  _setEnforcementBlockedForTest(false)
})

test("flow: _resetTrinitySlotsForTest resets without crash", () => {
  applySlot("brain", "deepseek/deepseek-v4-pro")
  _resetTrinitySlotsForTest()
  const r1 = applySlot("cheap", "deepseek/deepseek-chat")
  assert.equal(r1.ok, true, "applySlot works after reset")
})

test("flow: multiple rapid applySlot calls do not crash", () => {
  _resetTrinitySlotsForTest()
  for (let i = 0; i < 10; i++) {
    const slot = ["brain", "cheap", "medium"][i % 3]
    const result = applySlot(slot, "model-" + i)
    assert.equal(result.ok, true, "iteration " + i + " returns ok:true")
  }
})
