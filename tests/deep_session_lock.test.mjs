// SPDX-License-Identifier: MIT
// DEEP TEST 5: Session — getCurrentSessionId, setCurrentSessionId, applySlot lifecycle
import test from "node:test"
import assert from "node:assert/strict"

const mod = await import("../dist/vibeOS.js")
const { applySlot, getCurrentSessionId, setCurrentSessionId, _resetTrinitySlotsForTest } = mod

test("session: getCurrentSessionId returns string or undefined", () => {
  const id = getCurrentSessionId()
  assert.ok(id === undefined || typeof id === "string", "session id is string or undefined")
})

test("session: setCurrentSessionId sets and getCurrentSessionId retrieves", () => {
  setCurrentSessionId("lock-test-session-123")
  const id = getCurrentSessionId()
  assert.equal(id, "lock-test-session-123", "session id matches what was set")
})

test("session: applySlot succeeds on unlocked session", () => {
  _resetTrinitySlotsForTest()
  setCurrentSessionId("unlock-test")
  const r1 = applySlot("brain", "deepseek/deepseek-v4-pro")
  assert.equal(r1.ok, true, "brain slot set on unlocked session")
  const r2 = applySlot("cheap", "deepseek/deepseek-chat")
  assert.equal(r2.ok, true, "cheap slot set on unlocked session")
})

test("session: switching brain->cheap->brain works without lock", () => {
  _resetTrinitySlotsForTest()
  setCurrentSessionId("switch-cycle-test")
  const r1 = applySlot("brain", "deepseek/deepseek-v4-pro")
  assert.equal(r1.ok, true)
  const r2 = applySlot("cheap", "deepseek/deepseek-chat")
  assert.equal(r2.ok, true)
  const r3 = applySlot("medium", "deepseek/deepseek-chat")
  assert.equal(r3.ok, true)
  const r4 = applySlot("brain", "deepseek/deepseek-v4-pro")
  assert.equal(r4.ok, true, "full cycle completes")
})

test("session: invalid slot name does not crash", () => {
  _resetTrinitySlotsForTest()
  setCurrentSessionId("invalid-slot-test")
  try {
    const r = applySlot("nonexistent", "model")
    assert.ok(r, "returns result even for invalid slot")
  } catch (e) {
    assert.ok(e instanceof Error, "throws Error for invalid slot")
  }
})

test("session: rapid switching does not corrupt state", () => {
  _resetTrinitySlotsForTest()
  setCurrentSessionId("rapid-switch-test")
  const slots = ["brain", "cheap", "medium", "brain", "cheap", "medium", "brain"]
  for (const slot of slots) {
    const r = applySlot(slot, "model-" + slot)
    assert.equal(r.ok, true, "slot " + slot + " applies successfully")
  }
  // Final state should be valid
  const final = getCurrentSessionId()
  assert.equal(final, "rapid-switch-test", "session ID unchanged after rapid switching")
})

test("session: setSessionId persists across multiple calls", () => {
  setCurrentSessionId("persist-test-a")
  assert.equal(getCurrentSessionId(), "persist-test-a")
  setCurrentSessionId("persist-test-b")
  assert.equal(getCurrentSessionId(), "persist-test-b")
  setCurrentSessionId("persist-test-a")
  assert.equal(getCurrentSessionId(), "persist-test-a", "can switch back")
})
