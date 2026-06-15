// SPDX-License-Identifier: MIT
import { test, describe } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../chat-transform.js")
const { mergeRemoteControlVector, regimeAwareToolStyleDirective } = mod

test("module exports expected symbols", () => {
  assert.equal(typeof mergeRemoteControlVector, "function")
  assert.equal(typeof regimeAwareToolStyleDirective, "function")
  assert.equal(typeof mod.syncControlSettings, "function")
  assert.equal(typeof mod.onSystemTransform, "function")
  assert.equal(typeof mod.onMessagesTransform, "function")
})

describe("mergeRemoteControlVector", () => {
  test("remote fields spread then local overrides the 7 control fields", () => {
    const remote = { enforcement_mode: "strict", some_extra: "preserved" }
    const local = { enforcement_mode: "relaxed" }
    const r = mergeRemoteControlVector(remote, local)
    assert.equal(r.enforcement_mode, "relaxed")
    assert.equal(r.some_extra, "preserved")
  })

  test("null remote", () => {
    const r = mergeRemoteControlVector(null, { enforcement_mode: "strict" })
    assert.equal(r.enforcement_mode, "strict")
  })

  test("null local — local fields become undefined, remote spread fields survive", () => {
    const remote = { enforcement_mode: "strict", some_extra: "survives" }
    const r = mergeRemoteControlVector(remote, null)
    assert.equal(r.enforcement_mode, undefined)
    assert.equal(r.some_extra, "survives")
  })

  test("both null returns empty object", () => {
    const r = mergeRemoteControlVector(null, null)
    assert.equal(typeof r, "object")
  })

  test("local overrides 7 control fields, other remote fields survive via spread", () => {
    const remote = { agent_mode: "coder", tier_bias: "brain", extra_field: "survives-spread" }
    const local = { agent_mode: "architect" }
    const r = mergeRemoteControlVector(remote, local)
    assert.equal(r.agent_mode, "architect")
    assert.equal(r.tier_bias, undefined)
    assert.equal(r.extra_field, "survives-spread")
  })
})

describe("regimeAwareToolStyleDirective", () => {
  test("LOOPING regime produces loop-breaking directive", () => {
    const d = regimeAwareToolStyleDirective("LOOPING", "speed", 0, "")
    assert.ok(d.includes("verification-first"))
    assert.ok(d.includes("loop-breaking"))
  })

  test("returns non-empty string for all regimes", () => {
    for (const regime of ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]) {
      const d = regimeAwareToolStyleDirective(regime, "budget", 0, "")
      assert.equal(typeof d, "string")
      assert.ok(d.length > 0, `${regime} should produce non-empty directive`)
    }
  })
})
