import { describe, it } from "node:test"
import assert from "node:assert/strict"

const turn = await import("../turn-classify.js?control-history-guard=" + Date.now())

describe("buildControlHistoryEntry — guards against empty control vectors", () => {
  it("returns null for an empty control object (prevents hollow {} control_history entries)", () => {
    const entry = turn.buildControlHistoryEntry(1, "INIT", {})
    assert.equal(entry, null, "empty control vector must not produce a pushable entry")
  })

  it("returns null when control is null or undefined", () => {
    assert.equal(turn.buildControlHistoryEntry(1, "INIT", null), null)
    assert.equal(turn.buildControlHistoryEntry(1, "INIT", undefined), null)
  })

  it("returns a populated entry when control has real fields", () => {
    const control = { enforcement_mode: "strict", flow_mode: "audit", tier_bias: "brain" }
    const entry = turn.buildControlHistoryEntry(1, "INIT", control)
    assert.notEqual(entry, null)
    assert.equal(entry.control.enforcement_mode, "strict")
    assert.equal(entry.control.tier_bias, "brain")
    assert.equal(entry.turn, 1)
    assert.equal(entry.regime, "INIT")
  })
})
