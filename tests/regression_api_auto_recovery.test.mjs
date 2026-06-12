import { describe, it } from "node:test"
import assert from "node:assert/strict"

function handleAPIFailure(currentMode, failureCount, lastSuccessAt) {
  if (currentMode === "auto") {
    return { mode: "budget", escalated: true, reason: "api_failure" }
  }
  return { mode: currentMode, escalated: false, reason: null }
}

function attemptRecovery(mode, failureCount, recoveryIntervalMs) {
  if (mode !== "budget" && mode !== "quality") return { mode, recovered: false }
  if (failureCount > 0) {
    return { mode: mode, recovered: false, reason: `waiting for recovery, ${failureCount} failures remaining` }
  }
  return { mode: "auto", recovered: true, reason: null }
}

describe("regression: API auto mode recovery (E10)", () => {
  it("auto mode falls back to budget on API failure", () => {
    const result = handleAPIFailure("auto", 1, null)
    assert.equal(result.mode, "budget")
    assert.equal(result.escalated, true)
    assert.equal(result.reason, "api_failure")
  })

  it("non-auto modes are NOT affected by API failure", () => {
    const result = handleAPIFailure("speed", 1, null)
    assert.equal(result.mode, "speed")
    assert.equal(result.escalated, false)
  })

  it("budget mode does not escalate further on failure", () => {
    const result = handleAPIFailure("budget", 2, null)
    assert.equal(result.mode, "budget")
    assert.equal(result.escalated, false)
  })

  it("recovery restores auto mode when failure count reaches 0", () => {
    const result = attemptRecovery("budget", 0, 60000)
    assert.equal(result.mode, "auto")
    assert.equal(result.recovered, true)
  })

  it("recovery waits when failures remain", () => {
    const result = attemptRecovery("budget", 3, 60000)
    assert.equal(result.mode, "budget")
    assert.equal(result.recovered, false)
    assert.ok(result.reason.includes("waiting"))
  })

  it("non-fallback modes are not recovered to auto", () => {
    const result = attemptRecovery("speed", 0, 60000)
    assert.equal(result.mode, "speed")
    assert.equal(result.recovered, false)
  })

  it("repeated API failures don't cascade into deeper degraded modes", () => {
    let mode = "auto"
    for (let i = 1; i <= 5; i++) {
      const result = handleAPIFailure(mode, i, null)
      mode = result.mode
    }
    // Should stay in budget, not cascade further
    assert.equal(mode, "budget")
  })
})
