import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as policy from "../session-policy.js"

describe("session-policy", () => {
  beforeEach(() => {
    policy.resetSessionPolicyStateForTest()
  })

  it("prioritizes security and budget signals", () => {
    assert.equal(policy.resolveTemplate("save", 0.1, "possible token leak", 90, "REFINING"), "security")
    assert.equal(policy.resolveTemplate("quality", 0.1, "general planning", 39, "REFINING"), "save")
  })

  it("keeps looping regimes on quality even when budget is low", () => {
    assert.equal(policy.resolveTemplate("save", 0.1, "general planning", 20, "LOOPING"), "quality")
  })

  it("detects loop repetition and injects changed templates", () => {
    assert.equal(policy.detectLoopSignal("read"), false)
    assert.equal(policy.detectLoopSignal("read"), false)
    assert.equal(policy.detectLoopSignal("read"), true)
    assert.equal(policy.shouldInjectTemplate("quality", "save"), true)
    assert.equal(policy.shouldInjectTemplate("quality", "quality"), false)
  })
})
